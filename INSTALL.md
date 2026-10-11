# ByeBoer: put it on GitHub and install it

ByeBoer installs like an app on your phone or computer and works offline. Your records are stored only on the device. They never go to GitHub or anywhere else. They leave the device only when you save an Excel file, a PDF, a quote, an invoice or a backup.

GitHub Pages is used once, to deliver the app to your device. It hosts only the app itself, never your records.

## 1. Put the app on GitHub Pages (on your PC, about 10 minutes, one time only)

1. Unzip **byeboer.zip** on your PC.
2. Go to https://github.com and sign in.
3. Click **+** (top right) and choose **New repository**.
   - Repository name: `ByeBoer`
   - Choose **Public**. Free GitHub Pages needs this. Only the app code is public, never your records.
   - Click **Create repository**.
4. On the new page, click the **uploading an existing file** link.
5. Open the unzipped folder and select **everything inside it**: `index.html`, `app.js`, `i18n.js`, `export.js`, `sw.js`, `manifest.webmanifest`, `README.md`, `INSTALL.md` and the **icons** folder. Drag them all onto the GitHub page, then click **Commit changes**.
   - Check that the list on GitHub shows an `icons` folder. If it doesn't, click **Add file → Upload files**, drag the `icons` folder in and commit again.
6. Go to **Settings → Pages** (in the left menu).
   - Under *Build and deployment*, set Source to **Deploy from a branch**, Branch to **main**, and folder to **/ (root)**. Click **Save**.
7. Wait 1–2 minutes, then refresh the page. It shows your app link:
   `https://wariekert007.github.io/ByeBoer/`

## 2. Install it

**Android phone (Chrome)**
1. Open the link in **Chrome**. If you send it to yourself on WhatsApp, open it in Chrome, not inside WhatsApp.
2. Tap the **Install** button at the top of the app, or Chrome's **⋮ → Install app** (or **Add to Home screen**).
3. Open **ByeBoer** from your home screen.

**iPhone (Safari)**
1. Open the link in **Safari**.
2. Tap the **Share** button, then **Add to Home Screen**.

**Computer (Chrome or Edge)**
1. Open the link.
2. Click the install icon at the right of the address bar, or the **Install** button in the app.

After the first visit, the app works without signal.

## Using it

- **First time:** choose your language (English or Afrikaans), your business name, your name and phone number, whether you are VAT-registered, and whether you want to keep fuel records.
- **Settings first (once):** upload your **logo**, and fill in your address, email, **banking details** and **terms**. These are printed on every quote and invoice. Here you also set the quote and invoice numbers, how many days clients have to pay, a deposit percentage for quotes, your rate per km, and your beekeeper registration number with its renewal date.
- **Hives:** add your **apiaries** (home yard, out-apiaries, pollination sites). Stand at the apiary and tap **Here** to save the GPS position, even without signal. Then add the hives at each apiary. Each hive shows a coloured dot: green is fine, orange needs an inspection, red has a problem (low stores, queenless, suspected AFB…).
- **Inspect:** record the queen, brood, stores, temper and any problems, and choose when the next inspection is due. Home reminds you when it's time.
- **Harvest:** record kilograms of honey and wax per hive or for a whole apiary. You see the total for the tax year and per hive.
- **Feed / treat:** feeding, treatments, supers, new queens, splits and moves. A move updates where the hives are. After a split, the app asks you to add the new hive.
- **Work (quotes & invoices):**
  - Tap **New quote** or **New invoice**. Pick a client or add a new one right there.
  - Tap your services to add them as lines, or type your own. Tick **Charge travel** to add km × rate.
  - Save, then **Share PDF** to send it on WhatsApp or email, or **Save PDF**.
  - When the client accepts a quote, tap **Make invoice from this quote**. Everything is copied over.
  - When the client pays, tap **Record payment**. The payment is added to your income in **Money** automatically. Part payments work too.
  - Home warns you about overdue invoices and quotes without an answer.
- **Money:** income and expenses with beekeeping categories, slip photos, and repeating payments (site rent, insurance…). **Fuel** is under Money if you switched it on.
- **Reports:** pick a period and save an **Excel** file (every record, on separate sheets) or a **PDF** report for your bank or accountant.

### Daily diary reminder on your phone

A web app can't ring a daily alarm by itself. Go to **Settings → Daily diary reminder** and tap **Google Calendar** (Android) or **Calendar file (.ics)** (iPhone, Outlook, Samsung Calendar). You only need to do this once.

## Important

- Records live only in the app on this device. They are deleted if you uninstall the app or clear the browser's data for the site, and they don't move to a new phone by themselves.
- **Make a backup regularly:** **Reports → Save backup** (or **Settings → Backup**). Keep the backup file on your PC or Google Drive, or email it to yourself. On a new phone, install the app and tap **Restore a backup**. The app reminds you when your last backup is more than 30 days old.
- The Excel and PDF files are for reading and sending. Only the **backup** file (.json) can be loaded back into the app. It includes your logo and slip photos.
- ByeBoer and FarmLedger are separate apps with separate records. You can install both.
- **Updating the app later:** upload the changed files to the same GitHub repository. Also open `sw.js` and change the version number at the top (for example `byeboer-v1` to `byeboer-v2`), or phones keep the old version. The phone picks up the new version the next time you open the app with signal. Your records are kept.
