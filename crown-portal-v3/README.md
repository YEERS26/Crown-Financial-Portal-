# 👑 The Crown — Financial Portal v3
## Supabase + Cloudflare Pages deployment

---

## File structure

```
crown-portal-v3/
├── public/                        ← Deploy this folder to Cloudflare Pages
│   ├── index.html
│   ├── _redirects
│   ├── styles/main.css
│   └── js/
│       ├── config.js              ← Paste your Supabase keys here
│       └── app.js
└── supabase/
    └── migrations/
        └── 001_schema.sql         ← Run once in Supabase SQL Editor
```

---

## Step 1 — Supabase

1. Go to https://app.supabase.com → create a new project
   - Name: `crown-portal`
   - Region: EU West (Ireland) — closest to Hull
   - Save your database password somewhere safe

2. **SQL Editor** (left sidebar) → paste the full contents of
   `supabase/migrations/001_schema.sql` → click **Run**
   This creates both tables and inserts all 26 payments.

3. **Authentication → Users** → **Add user → Create new user**
   - Email: chris@thecrown.pub (or any email)
   - Password: choose something secure
   - Tick **Auto Confirm User**
   - Click **Create user**

4. **Settings → API** → copy these two values:
   - **Project URL** → looks like `https://abcdefgh.supabase.co`
   - **anon / public key** → long string starting `eyJ...`

---

## Step 2 — Add your keys

Open `public/js/config.js` and replace:

```js
export const SUPABASE_URL      = 'YOUR_SUPABASE_URL';
export const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

with your actual values from Step 1.

---

## Step 3 — GitHub

```bash
git init
git add .
git commit -m "Crown Portal v3"
git remote add origin https://github.com/YOUR_USERNAME/crown-portal.git
git push -u origin main
```

---

## Step 4 — Cloudflare Pages

1. Go to https://pages.cloudflare.com
2. **Create application → Pages → Connect to Git**
3. Select your `crown-portal` repo
4. Build settings:
   - Framework preset: **None**
   - Build command: *(leave blank)*
   - Build output directory: **`public`**
5. Click **Save and Deploy**

Done — Cloudflare gives you a URL like `crown-portal.pages.dev` within 60 seconds.

---

## What syncs to Supabase

| Action | What happens |
|--------|-------------|
| Change amount in Price list | DB updated instantly + all future unpaid instances cascade |
| Change frequency | Old future instances deleted, new schedule generated in DB |
| Change status (Paid/To pay) | Instance row updated in DB |
| Update credit balance | Definition row updated in DB |
| Add new payment | New definition + future instances inserted |
| Delete payment | Definition + all instances deleted (cascade) |
| Click a calendar day | Instance statuses updated in DB live |

All changes are real-time — open on phone and desktop simultaneously and both stay in sync.

---

## Custom domain (optional)

Cloudflare Pages → your project → **Custom domains** → Add.
If the domain is already on Cloudflare DNS it connects automatically.
Example: `portal.thecrownhull.co.uk`
