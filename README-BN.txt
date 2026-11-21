Daily Ledger — Updated PWA package

Files:
- index.html: app
- manifest.webmanifest: install metadata and logo
- icon-512.png: generated navy/gold app logo resized to 512x512
- icon.svg: fallback icon
- sw.js: offline app shell/service worker cache
- DATA-CHECK.txt: original ledger data check
- FEATURE-CHECKLIST-BN.txt: manual phone testing checklist

Deploy the contents of this folder to Netlify over HTTPS. Keep the old site and JSON backup until the new version is tested. A hosted origin has separate browser storage from a local content:// HTML file. Import/restore a backup carefully and keep the original JSON untouched.

Advanced tools store their metadata locally in a separate localStorage key. The “Full JSON backup” includes both ledger and tool metadata; the existing ledger JSON restore flow may not restore advanced tool metadata, so retain the full JSON backup separately.

Not yet verified end-to-end on the user's Android device/Netlify site. Test with the checklist before trusting it for daily financial records.

Backup safety update:
- Import preview includes export timestamp, date range, record counts and totals.
- Invalid backup structure/amounts are rejected before import.
- Import merges records; it does not replace the current ledger. A safety copy is downloaded first.
- Destructive reset requests a full safety download and two explicit confirmations.
- Always verify the downloaded JSON file exists and keep a copy outside the device. Browser download cannot be guaranteed by the app itself.


JSON DATA BINDING UPDATE
- Embedded seed data is taken from the user-provided daily-ledger-backup (1).json file.
- The JSON source was embedded as provided; no amounts were invented or auto-corrected.
- On a browser origin with existing localStorage, the app preserves that browser data at startup. Use a new test site/origin to see the embedded JSON seed. Do not clear old site data without a verified backup.
- The source backup contains 142 expense rows (including note/closing rows), 4 deposits, and 5 bank/MFS transactions.


CORRECTION BUILD:
- Embedded seed data comes from daily-ledger-full-backup-2026-10-12.json (ledger section).
- This test build uses a fresh localStorage key so older test entries do not get mixed into this corrected seed.
- Existing app/site data is not deleted. Keep your original JSON backup safe.


গুরুত্বপূর্ণ ডাটা নোট (১৪ অক্টোবর ২০২৬): এই build-এ আপনার আপডেটেড JSON-এর সব 148 expense, 5 deposit, 5 bank/MFS transaction এবং settings/notes embed করা আছে। আলাদা storage key ব্যবহার করা হয়েছে, যাতে আগের browser-এর অসম্পূর্ণ localStorage নতুন JSON-কে override না করে। প্রথমবার খুললে এই build-এর embedded JSON লোড হবে; এরপর এই build-এ করা পরিবর্তন এই browser-এ save হবে। পুরোনো app-এর data মুছবেন না।


সর্বশেষ JSON ডাটা (১৬ অক্টোবর ২০২৬): এই build-এ ব্যবহারকারীর সর্বশেষ আপলোড করা JSON embed করা আছে। Record count: expenses=170, deposits=6, bankTransactions=7, transfers=0। এই build আলাদা localStorage key ব্যবহার করে, তাই প্রথমবার নতুন JSON লোড হবে। এরপর এই build-এ করা পরিবর্তন একই browser-এ save হবে। পুরোনো app বা backup মুছবেন না।
