# CargoPulse: air-cargo recovery, decided in minutes

**Team:** Captain Fable (E275) · Cathay Hackathon 2026

**Code repository:** https://github.com/AidenWong1286/cargopulse-hackathon-2026
(public; this repository contains exactly the submitted version)

**Prototype:** a working web application. It runs on your own computer with Docker
(steps below). It is not hosted on a public website.

> All data in CargoPulse is synthetic (made up). It is not connected to any airline
> system, and nothing is ever sent outside the app. CargoPulse is a hackathon
> prototype and is not affiliated with or endorsed by Cathay Pacific.

---

## What it does

When flights are cancelled at a hub, hundreds of cargo containers suddenly need a new
flight before their deadlines. CargoPulse proposes where each container should go, in
seconds, and a person makes the final decision.

- **Recover:** re-plans every affected container after a disruption at Hong Kong. An
  optimiser (HiGHS) finds the best plan, and a separate validator re-checks it against
  safety, dangerous goods, space, customs, cutoff, cold-chain and handling rules. The
  plan is compared with two simple rules ("earliest flight first" and "priority first")
  on the same data.
- **Protect:** for one overbooked flight before cutoff, chooses which booked shipments
  fly so fewer are left behind, within weight and volume together.
- **Proof:** runs the algorithm on fresh random disruptions and checks every answer
  three ways: is it safe, is it truly the best (exact check on small cases), and does
  it beat the simple rules.
- **A person decides:** every approval, rejection or escalation is recorded with an
  immutable receipt and an audit trail.

### Results from our before/after study (synthetic data)

- **Protect**, 1,000 test flights: shipments left behind fell from **11.2% to 6.5%**
  (about 42% fewer), with no priority or express shipment dropped.
- **Recover**, 200 random disruptions of 140 containers: **4.3 more containers placed**
  per disruption on average and **about 14% lower total delay cost** than the better
  simple rule. CargoPulse was never worse in any of the 200.

Full study data is in the repository under `docs/evidence/before-after/`.

---

## How to run it

**You need:** Docker Desktop (running), Python 3, Git, and at least 4 GB of free memory.

1. Get the code:
   ```
   git clone https://github.com/AidenWong1286/cargopulse-hackathon-2026.git
   cd cargopulse-hackathon-2026
   ```
2. Create the private local settings (on Windows use `python`, on Mac/Linux `python3`):
   ```
   python scripts/configure_local.py
   ```
3. Build and start the app (the first build takes a few minutes):
   ```
   docker compose up --build -d
   ```
4. Open **http://localhost:3000** in Chrome or Edge.

To stop it: `docker compose down` (your data is kept for next time).

---

## 3-minute demo path

1. **Sign in:** keep the role **Manager** and press **Enter evaluation workspace**.
2. **Recovery desk:** press **Start demo scenario**. A new random disruption is created
   from real generated data.
3. **Solve:** on the scenario page press **Solve & compare**. Watch every container
   find its flight, then press **Review proposal**.
4. **Decide:** read the verdict, then record a decision to see the decision receipt.
5. **Protect:** open **Protect** in the left menu and press **Plan this flight**.
6. **Proof:** open **Proof** and press **Run the proof**.

**Shortcut:** press **Present** in the top bar to auto-play the whole story. The top bar
also has a day/night switch, optional sound (off by default) and a performance mode for
slower laptops.

The app works in English and Traditional Chinese (switch with 繁體中文 in the top bar).

---

## How it is built

- **Web app:** Next.js and React (`apps/web`), bilingual, with WebGL and 3D effects
  that use only real data.
- **API:** FastAPI with roles, tenants, an immutable history and audited decisions
  (`services/api`).
- **Worker:** route building, the HiGHS optimiser, the two reference rules, urgency
  analysis and an independent validator (`services/worker`).
- **Storage:** PostgreSQL and Redis, all started by Docker Compose.

More technical detail is in [TECHNICAL_README.md](TECHNICAL_README.md).
