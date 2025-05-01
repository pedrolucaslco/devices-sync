# 📦 Devices Sync Plugin – Supabase Setup Guide

This guide helps you configure your own Supabase project to use with the Devices Sync plugin for Obsidian. This is a **self-hosted synchronization method**, so your data stays 100% under your control.

---

## ✅ What You Need

- A Supabase account: [https://supabase.com](https://supabase.com)
- A new or existing Supabase project
- A Storage Bucket (e.g. named `notes`)

---

## 🧰 Step-by-Step Setup

### 1. Create a Supabase Project
1. Log in to [https://supabase.com](https://supabase.com)
2. Click **"New project"**
3. Choose:
   - Project Name
   - Password
   - Region
   - Organization (or personal)

Wait a few seconds until the project is created.

---

### 2. Create a Storage Bucket
1. In the left sidebar, click **"Storage"**
2. Click **"Create a new bucket"**
3. Name it something like `notes`
4. Uncheck **"Public bucket"** if you want privacy (recommended)
5. Click **"Create"**

---

### 3. Configure Bucket Policy
If your bucket is private, you must allow read/write access using Supabase **Policies**:

1. Go to the **SQL Editor** in Supabase
2. Run the following SQL (replace `notes` with your bucket name if needed):

```sql
-- Allow all read access to Storage
create policy "Allow read access to storage" on storage.objects
  for select using (true);

-- Allow insert/update/delete if using anon key
create policy "Allow write access for anon users" on storage.objects
  for all using (auth.role() = 'anon');
```

> You can also manage this via **Authentication > Policies**, if preferred.

---

### 4. Copy Project Credentials
1. Go to **Settings > API**
2. Copy:
   - `Project URL` → use as **Supabase URL** in the plugin
   - `anon/public key` → use as **Supabase Key** in the plugin

---

## 🔧 Configure the Plugin
In Obsidian:

1. Go to **Settings > Community plugins > Devices Sync**
2. Enter:
   - **Supabase URL** (from step 4)
   - **Supabase Key** (from step 4)
   - Bucket name (default is `notes`)

Done ✅

---

## 📌 Tips
- You can use **multiple vaults**, each pointing to a different Supabase project or bucket
- To ensure privacy, avoid public buckets unless required
- Supabase's free tier is generous, but check your usage limits

---

## 📚 Resources
- Supabase JS docs: https://supabase.com/docs/guides/with-js
- Storage guide: https://supabase.com/docs/guides/storage
- Row-level security (RLS): https://supabase.com/docs/learn/auth-deep-dive/auth-row-level-security

---

Need help? Open an issue on GitHub or ask in the Obsidian forums.

Happy syncing! 🔄

