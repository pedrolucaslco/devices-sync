# 📱 Devices Sync — Obsidian Plugin

Sync your Obsidian vault across multiple devices using [Supabase](https://supabase.com).

---

## ✨ Features

- 🔁 **Automatic sync** every 5 seconds after file changes.
- 📥 **Manual sync button** in the sidebar.
- 🔐 **Simple integration with Supabase**.
- ✅ Safe **filename conflict resolution** using aliases.
- ⏱️ **Timestamps used to detect latest version** of each note.

---

## ⚙️ Setup

1. Open **Obsidian Settings**.
2. Go to the **Devices Sync Settings** tab.
3. Enter your Supabase project credentials:

   - `Supabase URL` – e.g., `https://your-project.supabase.co`
   - `Supabase Key` – use your anon/public key

🔗 [How to set up Supabase](https://supabase.com/docs/guides/with-js)

---

## 📌 How It Works

### Monitoring

- The plugin listens to changes in `.md` files.
- Every 5 seconds, it uploads any modified files to Supabase.

### Manual Sync

- Click the cloud icon in the sidebar to trigger sync:
  - ⬆️ Uploads all local notes to Supabase.
  - ⬇️ Downloads any newer notes from Supabase to overwrite local files.

---

## 🛠️ Technical Details

### Upload

- Files are saved to the `notes` table in Supabase.
- Each note includes:
  - `id` (based on alias of the name)
  - `content`
  - `metadata`:
    - `original_name`: actual file path in Obsidian
    - `alias`: safe cloud ID (URL-safe)
    - `updated_at`: last modification timestamp

### Download

- Notes from Supabase will overwrite local ones only if their `updated_at` is newer.
- Local notes are not touched if they are more recent.

---

## 📦 Requirements

- You must install [`@supabase/supabase-js`](https://github.com/supabase/supabase-js) in your plugin environment:

```bash
npm install @supabase/supabase-js
```

---

## 🧠 About Aliases

Files are referenced in the cloud using an **alias** — a safe, encoded version of the filename. This prevents issues with special characters or accents when syncing between different operating systems.

---

## 🧪 Planned Improvements

- Selective folder syncing
- Version history
- Sync logs view

---

## 🧑‍💻 Author

Built with 💻 by [pedrolucaslco]https://github.com/pedrolucaslcosta).
