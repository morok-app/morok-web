# Morok Web Client — День 4

PIN-захист localStorage + Settings + опційний server backup.

## Що нового

**PIN (6 цифр):**
- Створюється при першій реєстрації, обов'язково
- Питається раз на годину при відкритті
- 5 невдалих → 30s lockout, 5 ще → 5хв, 5 ще → 1 год
- Якщо забув PIN — кнопка "Увійти за 24 словами"

**Server backup (опційно, в Settings):**
- Premium-only
- Юзер вводить passphrase 12+ символів
- Encrypted blob лежить на relay
- Restore через `@username + passphrase` на новому пристрої (без 24 слів)

**Settings екран:**
- Управління PIN (додати / видалити)
- Управління server backup
- Швидкий доступ до профілю

**Banner для існуючих юзерів:**
- На чатах: "Захистіть акаунт PIN-кодом" → setup flow
- Не блокуюче, можна ігнорувати

**Welcome:**
- 3 кнопки: Створити / 24 слова / @username + passphrase

## Файли що змінились

```
src/lib/vault.js              — нова, PBKDF2 + XChaCha20-Poly1305
src/lib/storage.js            — підтримка encrypted identity
src/lib/api.js                — додано backup endpoints
src/screens/PinSetup.jsx      — нова, створення PIN
src/screens/PinUnlock.jsx     — нова, введення PIN
src/screens/RestoreByUsername.jsx — нова, restore через passphrase
src/screens/Settings.jsx      — нова
src/screens/Welcome.jsx       — додано 3-тю кнопку
src/screens/CreateAccount.jsx — тепер веде на PIN setup
src/screens/LoginByMnemonic.jsx — теж веде на PIN setup
src/screens/ChatsList.jsx     — PIN banner + Settings button
src/App.jsx                   — повна реструктуризація boot flow
package.json                  — версія 0.4.0
```

## Деплой

**На ПК (PowerShell):**
```
cd C:\Users\1\Desktop\morok-web
```

Видали папки `node_modules` і `dist`:
```
Remove-Item -Recurse -Force node_modules
Remove-Item -Recurse -Force dist
```

Розпакуй ZIP сюди — замінить файли. Потім:
```
npm install
npm run build
```

**На сервері (relay1):**
```
rm /var/www/morok-web/assets/index-*.js /var/www/morok-web/assets/index-*.css
```

**На ПК:**
```
scp -r dist/* root@62.238.28.107:/var/www/morok-web/
```

**На сервері:**
```
chmod -R 755 /var/www/morok-web/
```

Відкривай `https://relay1.morok.app/web` з Ctrl+Shift+R.

## Як тестувати

**Тест 1 — banner для існуючого юзера @kaban:**
1. Заходиш як @kaban → бачиш червоний banner "Захистіть акаунт"
2. Тапаєш → PIN setup → вводиш 123456 двічі
3. Тебе кидає в чати → banner зник

**Тест 2 — refresh з PIN:**
1. Перезавантажуєш сторінку (F5)
2. Має зʼявитись екран "Введіть PIN"
3. Вводиш 123456 → потрапляєш у чати

**Тест 3 — lockout:**
1. Виходь і вводь неправильний PIN 5 разів
2. Має блокнути на 30 сек
3. Лічильник тікає

**Тест 4 — створення нового акаунта:**
1. Logout (видалити локальні дані)
2. Створи → 24 слова → confirm → PIN setup → claim username → чати

**Тест 5 — server backup (тільки якщо ти premium):**
1. Settings → "Створити backup" → passphrase 12+ символів
2. Видаляєш локальні дані
3. Welcome → "Або відновити через @username + passphrase"
4. Вводиш `@kaban` + passphrase → потрапляєш у чати

## Що далі — План

**День 5+:** Групи UI, DMS UI, верифікація номерів безпеки, темна/світла тема.
