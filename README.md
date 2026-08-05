# Medickids v2

אפליקציית PWA למעקב תרופות וחום ילדים.

## מבנה
- `js/app.js` — לוגיקה עסקית (לא נוגעים!)
- `js/db.js` — localStorage (גרסה נוכחית)
- `js/db-firestore.js` — Firestore (שלב הבא)
- `js/firebase.js` — Firebase init
- `js/auth.js` — Google Auth + Family management
- `js/migration.js` — מיגרציה מ-localStorage ל-Firestore

## חיבור Firebase
ראה `docs/INTEGRATION.md`
