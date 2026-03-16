# 👑 The Crown Financial Portal v3
## Neon (database) + GitHub + Cloudflare Pages

---

## File structure — push ALL of these to GitHub

```
crown-neon/
├── functions/
│   └── api/
│       └── [[route]].js       ← Cloudflare Pages serverless functions
├── public/
│   ├── index.html
│   ├── styles/
│   │   └── main.css
│   └── js/
│       └── app.js
├── sql/
│   └── schema.sql             ← Run once in Neon SQL editor
└── README.md
```

---

## Step 1 — Neon (free database)

1. Go to **https://neon.tech** → Sign up free (GitHub login works great)

2. Click **New project**
   - Name: `crown-portal`
   - Region: **EU Central (Frankfurt)** — closest free option to Hull
   - Click **Create project**

3. You'll see a connection string like:
   `postgresql://user:password@ep-xxx.eu-central-1.aws.neon.tech/neondb`
   **Copy this — you'll need it in Step 3.**

4. Click **SQL Editor** (left sidebar)
   Open `sql/schema.sql` from this project in Notepad, copy everything, paste it in, click **Run**
   This creates both tables and loads all 26 payments.

---

## Step 2 — GitHub

1. Go to **github.com** → **+** → **New repository**
   - Name: `crown-portal`
   - Click **Create repository**

2. On the empty repo page click **uploading an existing file**

3. Extract the ZIP, open the `crown-neon` folder
   Drag **all files and folders** into the GitHub upload box
   GitHub creates the folder structure automatically

4. Click **Commit changes**

---

## Step 3 — Cloudflare Pages

1. Go to **https://pages.cloudflare.com**
   → **Create application** → **Pages** → **Connect to Git**

2. Select your `crown-portal` GitHub repo

3. Build settings:
   - **Framework preset**: None
   - **Build command**: *(leave blank)*
   - **Build output directory**: `public`

4. Click **Environment variables** → Add these four:

   | Variable name          | Value |
   |------------------------|-------|
   | `NEON_CONNECTION_STRING` | your full connection string from Step 1 |
   | `NEON_URL`             | `https://ep-xxx.eu-central-1.aws.neon.tech/sql/v1` *(replace with your endpoint — found in Neon dashboard → Connection details → HTTP)* |
   | `NEON_API_KEY`         | your Neon API key *(Neon dashboard → Account → API keys → New key)* |
   | `APP_EMAIL`            | `chris@thecrown.pub` *(or whatever email you want Chris to log in with)* |
   | `APP_PASSWORD`         | a secure password for Chris |
   | `APP_SECRET`           | any long random string e.g. `crown2026xK9mPqR4` *(used to sign sessions)* |

5. Click **Save and Deploy**

   Cloudflare builds and gives you a URL like `crown-portal.pages.dev` in about 60 seconds.

---

## How it works

```
Browser  →  Cloudflare Pages (static files in /public)
                    ↓
         Cloudflare Functions (/functions/api/*)
                    ↓
              Neon Postgres (your database)
```

- The HTML/CSS/JS in `public/` is served as a static site
- When the app needs data it calls `/api/definitions`, `/api/instances` etc.
- Those calls hit the `functions/api/[[route]].js` file which runs on Cloudflare's edge
- That function queries Neon over HTTP and returns the data

---

## Logging in

Use the email and password you set in the environment variables (`APP_EMAIL` / `APP_PASSWORD`).

---

## Custom domain (optional)

Cloudflare Pages → your project → **Custom domains** → Add domain.
If the domain is already on Cloudflare DNS it connects in seconds.
Example: `portal.thecrownhull.co.uk`
