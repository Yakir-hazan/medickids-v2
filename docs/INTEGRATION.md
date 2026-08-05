# חיבור Firebase — Medickids

## שלב 1 — Firebase Console (5 דקות)

1. כנס ל-[console.firebase.google.com](https://console.firebase.google.com)
2. **Create project** → שם: `medickids`
3. **Firestore Database** → Create → **Native mode** → Israel (il) או Europe (eur3)
4. **Authentication** → Get started → **Google** → Enable → שמור
5. **Project Settings** → Your apps → **Web app** (`</>`) → Register
6. העתק את `firebaseConfig` שמופיע

---

## שלב 2 — הגדרת ה-config

פתח `js/firebase.js`, החלף את `FIREBASE_CONFIG`:

```js
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSy...",
  authDomain:        "medickids-xxxxx.firebaseapp.com",
  projectId:         "medickids-xxxxx",
  storageBucket:     "medickids-xxxxx.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abcdef",
};
```

---

## שלב 3 — Firestore Security Rules

ב-Firebase Console → Firestore → Rules, הדבק:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // family — רק members שלה יכולים לקרוא/לכתוב
    match /families/{familyId} {
      function isMember() {
        return request.auth != null &&
               request.auth.uid in resource.data.members;
      }
      function isNewFamily() {
        return request.auth != null &&
               request.auth.uid in request.resource.data.members;
      }

      allow read:   if isMember();
      allow create: if isNewFamily();
      allow update: if isMember();

      // כל subcollection — אותם rules
      match /{subcollection}/{docId} {
        allow read, write: if request.auth != null &&
          request.auth.uid in get(/databases/$(database)/documents/families/$(familyId)).data.members;
      }
    }
  }
}
```

---

## שלב 4 — הוספת Authorized Domain

Firebase Console → Authentication → Settings → Authorized domains:
- `localhost` (לפיתוח)
- `medickids.vercel.app` (פרודקשן)
- הדומיין האמיתי שלך

---

## שלב 5 — חיבור ל-index.html

### 4.1 — שנה את `<script>` בתחתית index.html

**לפני:**
```html
<script src="js/developer-console.js"></script>
<script src="js/db.js"></script>
<script src="js/app.js"></script>
```

**אחרי:**
```html
<script src="js/developer-console.js"></script>
<script type="module" src="js/main.js"></script>
```

### 4.2 — צור `js/main.js`

```js
// js/main.js — נקודת כניסה עם Firebase
import { DB }   from "./db-firestore.js";
import { Auth } from "./auth.js";

// שים את DB על window כדי ש-app.js יוכל להשתמש בו ללא שינוי
window.DB = DB;

// אתחל auth — מטפל בכל המסלולים
Auth.init({
  onNeedAuth() {
    // הצג מסך Login (Google Sign-In)
    App.goto("screen-login");
  },
  onNeedFamilyName(uid, displayName) {
    // הצג מסך Onboarding לשם משפחה
    App.goto("screen-onboarding");
  },
  onReady(state) {
    // ← כאן app.js ממשיך בדיוק כמו קודם
    App.init();

    // עדכן render בכל שינוי מ-Firestore
    DB.onChange(() => {
      App.renderDashboard?.();
      App.renderHistory?.();
      App.renderTemp?.();
    });
  },
  onError(err) {
    console.error("Auth error:", err);
    App.goto("screen-login");
  },
});

// טען את app.js כ-module נפרד
import("./app.js");
```

---

## שלב 6 — שינויים ב-app.js (מינימליים!)

`app.js` כמעט לא משתנה. רק שני דברים:

### 6.1 — כל קריאות DB הופכות ל-async

`db.js` היה סינכרוני. `db-firestore.js` הוא async.

פונקציות שכותבות נתונים (`saveMed`, `saveTemp`, `saveKid`, וכו׳) צריכות `await`:

```js
// לפני:
DB.addMedEntry(patch);

// אחרי:
await DB.addMedEntry(patch);
```

**רשימת הפונקציות שצריכות await:**
- `DB.addMedEntry` / `updateMedEntry` / `deleteMedEntry`
- `DB.addTempEntry` / `updateTempEntry` / `deleteTempEntry`
- `DB.updateChild` / `addChild`
- `DB.setSetting`
- `DB.addPrescription` / `updatePrescription` / `deletePrescription` / `logCourseDose`
- `DB.persist`
- `DB.reset`

### 6.2 — הוסף `async` לפונקציות שמשתמשות בהן:

```js
// לפני:
async function saveMed() { ... }

// הן כבר async — רק הוסף await לקריאות DB בפנים
```

---

## שלב 7 — בדיקה מקומית

```bash
# הרץ server מקומי (חייב https או localhost)
npx serve .
# או
python3 -m http.server 8080
```

פתח `http://localhost:8080` → Google Sign-In → תראה דשבורד ריק → הוסף ילד → בדוק ב-Firestore Console.

---

## שלב 8 — Vercel deploy

```bash
git add .
git commit -m "feat: Firebase infra - db-firestore + auth + migration"
git push
```

Vercel auto-deploy יעלה את הכל. ה-`api/notify.js` כבר שם.

---

## מה הגרסה הזו **לא** כוללת עדיין

- [ ] מסך Login (צריך להוסיף ל-index.html)
- [ ] מסך Onboarding (שם משפחה)
- [ ] מסך שיתוף קוד הזמנה
- [ ] Google Sign-In button ב-UI

אלה יגיעו בשלב ב׳ — אחרי שה-DB וה-auth עובדים.
