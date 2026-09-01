# RLDC admin creation rights — for confirmation before implementation

**Status: proposed, not built.** This is the user story and acceptance criteria
for the access-control change described as *"NRLDC should have rights to create
exactly one super-admin per RLDC, who then manages users within their own
region."*

It is written down rather than implemented because the proposal conflicts in
one place with what the portal does today, and the difference is not ours to
settle. The open questions at the end are the ones that need an answer first.

---

## What the portal does today

Implemented and tested as of commit `af7ece5`:

| Role | Sees | Can create |
| --- | --- | --- |
| `USER` / `QCA` | Own filings, own region | — |
| `ADMIN` | Own region only | Users, QCAs **and further admins** — own region |
| `SUPERADMIN` | Own region only — no more than an admin | The same, **plus** an admin for a *different* region |

Two properties are worth holding on to, because the proposal does not obviously
change either and both are load-bearing:

- **No role reads across regions.** A national administrator sees exactly what a
  regional one sees. The extra power is creation, not visibility.
- **There is no cap on admins per region.** A region can have as many as it
  wants, and any of them can appoint more.

---

## Where the proposal differs

> *"NRLDC should have rights to create **exactly one** super-admin per RLDC."*

That is a **cardinality constraint the portal does not have**. Today NRLDC can
create any number of admins for ERLDC.

It also sits awkwardly beside the rule confirmed in the previous round —
*"the admins can create other admin accounts as well"*. If ERLDC's admin can
appoint more ERLDC admins, then ERLDC does not have exactly one admin, and the
constraint only ever governed *the one NRLDC creates* rather than the region's
total.

Both readings are coherent. They produce different systems:

**Reading A — one *primary* admin per region.** NRLDC appoints each region's
first administrator, once. That person then runs the region and may appoint
ordinary admins beneath them. "Exactly one" constrains the appointment NRLDC
makes, not the region's headcount.

**Reading B — one administrator per region, full stop.** Each RLDC has a single
admin account. Nobody, including that admin, can create another. The region has
one throat to choke and one account to lose.

Reading B is a materially riskier system: a locked-out or departed RLDC admin
leaves the region unmanageable until NRLDC intervenes, and the portal has no
cross-region visibility to fall back on. Reading A is close to what is already
built, and would need only the cardinality rule added.

**Recommendation: Reading A.** It matches the confirmed rule that admins can
create admins, and it fails safe.

---

## User story

> **As** the national (NRLDC) administrator,
> **I want** to appoint one primary administrator for each regional load
> despatch centre,
> **so that** each region can be handed over and run independently, without
> NRLDC holding access to its data.

---

## Acceptance criteria

Written against Reading A. If Reading B is confirmed, AC-4 and AC-5 change and
AC-8 becomes a hard prohibition.

**AC-1 — NRLDC can appoint a regional primary admin**
Given I am signed in as the national administrator
When I create a user with role `ADMIN` and a region other than my own
Then the account is created in that region
And it is flagged as that region's **primary** administrator.

**AC-2 — Only one primary per region**
Given ERLDC already has a primary administrator
When the national administrator tries to create a second primary for ERLDC
Then it is refused, naming the existing holder
And no account is created.

**AC-3 — Only NRLDC can appoint a primary**
Given I am a regional administrator
When I try to create a primary administrator for any region, my own included
Then it is refused.

**AC-4 — A primary can appoint ordinary admins in its own region**
Given I am ERLDC's primary administrator
When I create a user with role `ADMIN` and no region, or region ERLDC
Then the account is created in ERLDC as an ordinary (non-primary) admin.

**AC-5 — Ordinary admins cannot appoint admins**
*(Open — see Q3. Today they can.)*
Given I am an ordinary ERLDC administrator
When I try to create another administrator
Then it is refused, and I am told to ask the region's primary.

**AC-6 — Region isolation is unchanged**
Given a primary administrator of any region, national or regional
When I list users, discrepancies, outages, logs or settings
Then I see only my own region's
And the national administrator sees no more than any other admin.

**AC-7 — Handover**
Given ERLDC's primary administrator has left
When the national administrator designates another existing ERLDC admin as primary
Then the flag moves to that account
And the previous holder becomes an ordinary admin
And the change is written to the system log with both usernames.

**AC-8 — A region is never left unmanageable**
Given ERLDC has a primary administrator
When anyone tries to delete, lock or demote that account
Then it is refused unless another ERLDC admin is designated primary first.

**AC-9 — Visible state**
Given I am the national administrator
When I open the region overview
Then each region shows its primary administrator, or *"no primary — region unmanaged"*
And `./nrldc.sh regions` reports the same.

---

## Open questions

These need answering before this is built. Each changes the work.

1. **Cardinality.** Reading A or Reading B? *(Recommendation: A.)*

2. **Naming.** The proposal calls the regional lead a *"super-admin"*, but in the
   portal `SUPERADMIN` is the **national** role. Two different things would
   share a name. Suggest `ADMIN` + an `is_primary` flag for the regional lead,
   leaving `SUPERADMIN` national — no new role, and no ambiguity in the logs.

3. **Can ordinary regional admins appoint admins?** They can today. AC-5 as
   drafted removes that. Which is wanted?

4. **Who owns the shared settings?** SMTP, the mail allowance and the OTP trust
   window are national today because one Brevo account sits behind all of them.
   Does that stay with NRLDC? *(Assumed yes.)*

5. **Does NRLDC administer NRLDC?** Today `admin@nrldc` is both the national
   administrator and NRLDC's regional one. Should those be separate accounts, so
   the national role holds no regional data at all?

6. **What happens to a region's data if its primary is removed and not
   replaced?** AC-8 prevents it, but confirm that is the wanted behaviour rather
   than allowing an unmanaged region.

---

## Implementation sketch

Small, if Reading A is confirmed. Roughly half a day.

- `users.is_primary_admin BOOLEAN NOT NULL DEFAULT FALSE`, with a partial unique
  index `(region) WHERE is_primary_admin` — the database enforces AC-2 rather
  than the application remembering to.
- `regionForNewAccount()` in `server/middleware/region.js` already decides who
  may create what and where; the cardinality rule goes there, beside the rest.
- A guard on delete/lock/demote for AC-8.
- The region overview and `./nrldc.sh regions` gain a primary column.
- Isolation is untouched: nothing here widens what anyone can see, so the
  existing 47-check region suite should keep passing unchanged, with new checks
  added for AC-2, AC-3, AC-7 and AC-8.
