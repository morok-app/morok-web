# Morok Web Client — День 1

Простий React+Vite додаток, мобайл-фірст. 6 екранів: Splash, Welcome,
CreateAccount, LoginByMnemonic, ClaimUsername, ChatsList (empty state).

Crypto: Ed25519 (signing) + BIP39 (24-словна mnemonic phrase) через
перевірені бібліотеки `@noble/curves` і `@scure/bip39`.

---

## Локально на ПК — побудувати

Потрібен Node.js 18+. Якщо немає — встанови з https://nodejs.org

```
cd C:\Users\1\Desktop\morok-web
npm install
npm run build
```

Це створить папку `dist/` з готовими статичними файлами.

**Тест локально (опційно):**
```
npm run preview
```
Відкривається на http://localhost:4173/web/

Перші запуски — створиш тестовий акаунт через `Створити аккаунт`, переконаєшся
що mnemonic генерується і claim username проходить.

---

## Деплой на relay1

### 1. Завантаж dist на сервер

З PowerShell на ПК:
```
scp -r dist root@62.238.28.107:/var/www/morok-web/
```

Запитає пароль root.

### 2. Налаштувати nginx

На relay1 як root, додай location-блок у конфіг:

```
nano /etc/nginx/sites-available/morok-relay
```

Знайди блок `server { server_name relay1.morok.app; ...` і **перед** блоком
`location / { proxy_pass http://morok_relay_backend; ... }` додай:

```nginx
location /web/ {
    alias /var/www/morok-web/;
    try_files $uri $uri/ /web/index.html;
    index index.html;
}
```

Перевір і застосуй:
```
nginx -t
systemctl reload nginx
```

### 3. Перевір

Відкрий https://relay1.morok.app/web у браузері.

Має з'явитись Splash → Welcome → "Створити аккаунт".

Створи тестовий акаунт, перевір що:
- 24 слова згенерувались
- "Продовжити" робить auth і веде до claim username
- Username резервується успішно
- Виводить empty state з твоїм юзернеймом

---

## Що в коді

```
src/
├── App.jsx                    # хеш-роутер
├── main.jsx                   # entry
├── lib/
│   ├── crypto.js              # Ed25519, BIP39, signing
│   ├── api.js                 # relay HTTP client
│   └── storage.js             # localStorage
├── screens/
│   ├── Splash.jsx
│   ├── Welcome.jsx
│   ├── CreateAccount.jsx      # generate + display mnemonic
│   ├── LoginByMnemonic.jsx    # restore from 24 words
│   ├── ClaimUsername.jsx
│   └── ChatsList.jsx          # empty state, logout
└── styles/global.css          # mobile-first, темна тема
```

---

## Безпека на День 1

**Що захищено:**
- Ed25519 signing через перевірений `@noble/curves`
- BIP39 mnemonic — стандартний словник (як у Bitcoin)
- HTTPS до relay'я
- Сесія expires через 7 днів

**Що **ПОКИ НЕ** захищено (буде у Дні 4):**
- Seed зберігається в localStorage у відкритому вигляді
- Хто має доступ до браузера — має доступ до акаунта
- PIN-захист додам у Дні 4 разом з backup feature

Це нормально для розробки. Не використовуй цю версію на основному акаунті.

---

## Що далі — План на дні

**День 1 — ✅ ТУТ ЗАРАЗ**
- Auth + claim username + базовий layout

**День 2 — наступний**
- Список чатів реальний (з контактами через `/users/lookup`)
- WebSocket inbox для real-time повідомлень
- Контакти UI

**День 3**
- 1-on-1 чат повний з композером
- Шифрування blob'ів (X25519 + ChaCha20-Poly1305)
- Burn-on-read клієнтський

**День 4**
- PIN захист seed у localStorage
- Encrypted backup flow (створення + відновлення через `/api/v1/backup`)

**День 5+**
- Групи UI
- DMS UI
- Settings, профіль, верифікація номерів безпеки
