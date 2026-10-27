# Pulse v4: two AIs, Gmail-style Inbox, Google-style Calendar, sidebar sub-tabs

Status: DRAFT for approval · 2026-10-27

## 1. Two AIs with clear jobs

| | Receptionist (name to choose) | Pulse AI |
|---|---|---|
| Talks to | the business's customers (WhatsApp, Telegram, web) | the owner and staff, inside the dashboard |
| Job | answer, book, move and cancel, hand over to staff | know everything, report, give commands, do tasks, advise |

### Receptionist: what it can do today (audited in `src/brain.js`)
- Books, moves and cancels appointments, and enforces the cancellation policy.
- Answers from services, FAQs, hours, policies and rules, in Arabic, English, French and Spanish.
- Gives instant replies to small talk, and hands a chat to staff when it doesn't know or the customer asks for a person.
- Sends reminders before appointments.

### Receptionist: skills to add
| Skill | Why it matters to the owner's customers |
|---|---|
| Waitlist | "Nothing free Thursday? I'll message you if a slot opens." Fills cancellations. |
| Deposit / payment link | Cuts no-shows on long or expensive services. |
| Smart upsell | "Add a blow-dry for $15?" only when it fits the slot. |
| Review request after a visit | Collects ratings automatically and sends happy clients to Google. |
| Lead capture | Saves name and number when someone asks but doesn't book, so Win back can follow up. |
| Follow-up after a handover | Tells the customer when staff will reply, so nobody is left waiting. |

### Pulse AI: what it can do today (audited in `src/team.js`)
- 20 read tools: today, bookings, free slots, services, customers, conversations, unanswered questions, reviews, rules, opportunities, top customers, quiet days, revenue, by service, by channel, busy times…
- 4 actions: add a rule, teach an answer, message a client, run an agent.

### Pulse AI: skills to add ("knows everything, commands, does tasks")
| Type | New skills |
|---|---|
| Command | book, move or cancel an appointment · block time · create an offer · change hours or prices · pause the AI in a chat |
| Task | owner to-dos with due dates ("remind me to call Rami Friday") · morning brief · end-of-day summary |
| Report | weekly or monthly report in one click, exported to PDF or Excel |
| Guide | "how do I…?" answered for any tab, opening the right page |
| Consultant | pricing advice, quiet-day fixes and staffing hints from the business's own data |

Every command shows a confirm button first. Nothing changes without the owner's OK, as today.

## 2. Inbox like Gmail
- **One line per conversation:** customer · first words of the last message · channel icon · status chip · time. Unread lines are bold.
- **Left rail of folders with counts:** Needs you · All · Bookings · Questions · Complaints · Done.
- **Opening a line:** the chat opens on the right with the customer card, plus **Reply**, **Take over** and **Mark done**.
- **Sources:** Pulse inbox (WhatsApp, Telegram, web, as today) plus **Linked email (Gmail)** as its own folder.

## 3. Calendar like Google Calendar
- **Day · Week · Month** switch, a mini month on the left, and **Today** and arrow buttons.
- **Appointment blocks:** customer + service only, colour by service, a short block for a short visit. Details open on click.
- **Linked Google Calendar:** its events show as grey "busy" blocks, so the receptionist never books over them.
- **Requests** (cancel or move) appear as a badge on the day, not as a separate wall of text.

## 4. Every tab: first thing first
The same order on every tab:
1. **What needs you:** the action strip at the top (0–3 items, with buttons).
2. **The headline numbers:** 3–4 tiles.
3. **The work area:** a list or chart.

Other rules:
- No paragraphs on screen: text opens on click.
- Empty states say the one next step.
- No text over text: every card checked at desktop and phone width.

## 5. Sidebar with sub-tabs
- The 10 pages stay. Each page folds open in the sidebar to show its tabs, for example:

  ```
  Settings ▾
    Profile · Assistant · Hours & team · Services · …
  ```

- The top tab row goes away, so the page gets more room.

## 6. Test lab, made friendly
Three steps on one screen: **pick a customer type → watch the chat → see the score**. It also gets a big **Run all tests** button.

## 7. Linking Gmail and Google Calendar
- Needs a Google Cloud project with an OAuth client (Gmail read and send, Calendar read and write) and Google's app review before real users can link.
- About 1 day to build. The owner signs in with Google once, in Settings › Channels.

## Build order (each step shippable)
1. Sidebar sub-tabs + "first thing first" layout + text-overlap fixes
2. Inbox (Gmail style)
3. Calendar (Google style)
4. Test lab redesign
5. Pulse AI command, task and report skills
6. Receptionist new skills
7. Gmail and Google Calendar linking
