# The Lab's own address and Support access (7 November 2026)

## What changed
| Address | What it is | Who can sign in |
|---|---|---|
| https://lab.nexfoyz.dev | The Lab: HQ, Controls, businesses, Support access | the admin only |
| https://app.nexfoyz.dev | Client dashboards, booking page, the MXAi website (`/pulse`) | owners and staff; **the admin is refused here** |
| http://localhost:3100 | This PC | everyone, as before (for building and tests) |

- A sign-in through the wrong address is answered like a wrong password and counts as one. Sessions are tied to one
  address, so signing in at the Lab never signs you in at the app address, and the other way round.
- Every page at the Lab address carries the strict browser security policy.
- `lab`, `app` and `www` can never be given to a client website.

## Support access (replaces "Open business")
- Opening a client from the Lab starts a visit that is **read-only on the server** and **ends by itself after 60
  minutes** (+30 min button, at most 4 hours). A banner shows it the whole time, with End.
- **Allow changes** needs a written reason. It is recorded, and the owner is told.
- The owner gets a notification when a visit starts and sees every visit in **Settings › Security › MXAi support
  access**: when, why, how long, and whether anything was changed.
- Test businesses open with changes allowed and nobody is notified (they are your playgrounds).
- Audit log: `support_started`, `support_edit_allowed`, `support_extended`, `support_ended`.

## Your step: the Cloudflare gate in front of the Lab (free, about 10 minutes)
This puts a Google sign-in in front of lab.nexfoyz.dev, so the Lab's page does not even load for anyone else.
1. Open https://one.dash.cloudflare.com and choose your account. First time: pick a team name and the **Free** plan
   (no card needed for up to 50 users).
2. **Access › Applications › Add an application › Self-hosted.**
3. Name: `MXAi Lab`. Session duration: `24 hours`. Application domain: `lab.nexfoyz.dev`.
4. Policy: name `Founder only`, action **Allow**, Include › **Emails** › `mhmdhasbini@gmail.com`.
5. Login method: **One-time PIN** (a code to your email) is on by default; Google can be added later.
6. Save. Open https://lab.nexfoyz.dev in a private window: you should see the Cloudflare sign-in first, then the MXAi
   Lab sign-in.
Optional extra lock afterwards: copy the application's **AUD tag** (Access › Applications › MXAi Lab › Overview) and
tell Claude; it can make the server refuse any Lab request that did not pass the gate.

## Not moved yet: the MXAi website
The MXAi website stays at `app.nexfoyz.dev/pulse` for now. `nexfoyz.dev` itself serves the Jarvis home, privacy and
terms pages that Google needs for your Google sign-ins, so moving the website there needs those pages kept at the same
addresses. Plan: copy the privacy and terms pages into the MXAi website, point `nexfoyz.dev` and `www` at the app,
serve the website on that host, keep `/privacy` and `/terms`, then redirect `app.nexfoyz.dev/pulse` to it.
