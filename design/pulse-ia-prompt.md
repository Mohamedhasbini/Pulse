# Pulse — navigation and page purpose (prompt for the next build)

Status: DRAFT for approval · 2026-10-27

## The problem today
- Pulse AI is one sidebar entry hiding **7 parts** (Overview, Teach, AI team, Test lab, Support, Performance, Insights), and most parts have **their own 3–4 sub-tabs**. That's two layers of tabs, and up to ~25 screens behind one button.
- **Data and tools are mixed.** Example: Teach AI shows quality stats, suggested lessons, versions and the rule editor on one page. Support and Performance (pure numbers) sit next to Teach (pure work).
- Pages don't say what they're for or what value they delivered, so the owner can't see the result of each part.

## The rules the build must follow
1. **One job per page.** Each sidebar entry answers one question ("What needs me?", "How is the AI doing?"…). If a page answers two, split it.
2. **Tools and data are separate.**
   - **Tool pages** are for doing things (approve, reply, teach, send). Lists and buttons, few numbers.
   - **Data pages** are read-only charts and tables. No forms or setup on them.
3. **At most one row of tabs, at most 3 tabs.** No tabs inside tabs. Related screens share a page as its tabs.
4. **Every page opens with its value line:** one sentence saying what it's for, plus 1–3 headline numbers proving it works. For example: "Pulse AI handled 86% of chats this week · saved ~6 hours".
5. **Text only on deep dive.** Pages show numbers and charts first; full text (transcripts, rule wording, explanations) opens on click.
6. **Phone first.** Every page works on a phone screen with no sideways scroll and the main action at the top.

## Proposed sidebar (v3: 10 pages, related things together)

Each page is one area of the business. Inside a page, at most 3 tabs, never a tab inside a tab.
Every tab opens with its value line (purpose + 1–3 live numbers).

| # | Page | What it's for | Tabs (max 3) | What's inside each tab | Value line at top |
|---|---|---|---|---|---|
| 1 | **Today** | What's happening and what needs me now | — | KPI tiles, live-now strip, next appointments, needs-you list, this week's brief (wins · risks · next steps) | appointments · revenue today · waiting for you |
| 2 | **Inbox** | Talk to customers | Conversations · Needs you · Delivery queue | all chats · chats the AI handed over · messages waiting to resend | chats open · waiting · avg reply time |
| 3 | **Calendar** | Run the schedule | Week · Requests · Booking page | the week grid · cancel/move requests · online booking link and rules | booked this week · free slots · pending requests |
| 4 | **Customers** | Know every client | Clients · Win back · Reviews | client list and history · lapsed regulars · ratings and review requests | clients · returning % · avg rating |
| 5 | **Marketing** | Bring customers in | Offers & codes · Agents · Website | campaigns and discount codes · AI agents with messages ready plus their results · public website | sent · booked after · $ earned |
| 6 | **Pulse AI** | Your AI assistant | Approvals · Ask Pulse · Brief | everything waiting for a decision · one chat that answers anything (Maya, Omar, Lina, Sam as skills) · full weekly brief | waiting · questions answered · this week vs last |
| 7 | **Train AI** | Make the receptionist smarter | Rules & coach · Answers · Review replies | strict rules plus plain-words coaching · questions it couldn't answer · rate and correct replies | rules · open questions · good-reply % |
| 8 | **Test lab** | Prove it works before customers see it | Scenarios · Versions | scripted customer tests · every change and its score | quality score · last run |
| 9 | **Insights** | Numbers only, no tools | AI performance · Business · Timing & channels | handled %, reply time, topics, satisfaction · revenue, services, avg ticket · busy days and hours, where chats and bookings come from | handled % · revenue · busiest day |
| 10 | **Settings** | Set it up once | Business & payments · Channels & reminders · Account | name, services, hours, FAQs, buffer, deposits · WhatsApp, Telegram, reminders · security, devices, plan, look | — |

Sidebar badges only where action is needed: Inbox (needs you), Calendar (requests), Pulse AI (approvals), Train AI (open questions).

## The master prompt

> You are an expert dashboard designer and AI-agent product builder rebuilding Pulse's navigation.
> Goal: every value Pulse gives the owner has its own clearly named page that shows its purpose, its proof (headline numbers) and its tools, with nothing blended in.
>
> **Do:**
> 1. Build the sidebar exactly as in the v3 table: 10 pages, max 3 tabs each. Remove the Pulse AI switcher and every second row of tabs.
> 2. For each page: a title, a one-line purpose, a value line with 1–3 live numbers from `metrics.js`, then the content. Max 3 tabs.
> 3. Keep tool pages and data pages separate: no charts on tool pages beyond the value line, and no forms on data pages.
> 4. Move existing panes into their new pages. Reuse the existing code and endpoints; no feature may disappear. Keep a list of every pane and where it went.
> 5. Badges in the sidebar only where action is needed: Inbox (chats waiting), Approvals (items waiting), Train (questions to answer).
> 6. Old links (notifications, Today buttons, `openpage` events) still land on the right new page.
>
> **Check before done:**
> - Every entry opens, with no console errors, in light and dark, at desktop (1440) and phone (390) width.
> - No page has more than 3 tabs or a tab inside a tab.
> - Every pane from the old layout is reachable (the checklist).
> - Every test suite is green.
> - Screenshots of every page, light and dark.

## Decisions for you
1. Ask Pulse: one "Pulse" chat with Maya, Omar, Lina, Sam as skills (recommended), or keep four separate chats?
