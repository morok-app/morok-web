# Morok Web — День 5

Видалення повідомлень/чатів, notifications, online indicator, scroll-to-bottom, unread badges.

## Що змінилося — 6 файлів

```
src/lib/notifications.js       (НОВИЙ)
src/lib/conversations.js       (replace — додано deleteMessage, markRead, countUnread)
src/screens/ChatRoom.jsx       (replace — long-press menu, scroll-to-bottom)
src/screens/ChatsList.jsx      (replace — long-press, online badge, unread)
src/screens/Settings.jsx       (replace — секція Notifications)
src/App.jsx                    (replace — broadcast inbox state, fire notifications)
```

## Деплой

**На ПК:**
```
cd C:\Users\1\Desktop\morok-web
```

Розпакуй цей ZIP сюди — замінить 5 файлів і додасть `notifications.js`.

```
npm run build
```

**На сервері (relay1):**
```
ssh root@62.238.28.107
rm /var/www/morok-web/assets/index-*.js /var/www/morok-web/assets/index-*.css
exit
```

**На ПК:**
```
scp -r dist/* root@62.238.28.107:/var/www/morok-web/
```

**На сервері:**
```
ssh root@62.238.28.107
chmod -R 755 /var/www/morok-web/
exit
```

Перезавантажуй `https://relay1.morok.app/web` з Ctrl+Shift+R.

## Що тестувати

**Тест 1 — видалення свого повідомлення:**
1. У чаті довге натискання на своє повідомлення (≥0.5 сек)
2. Зʼявиться меню: "Скопіювати / Видалити повідомлення"
3. Видали → зникає миттєво
4. Спробуй з невідправленого ще повідомлення — ще раз ack-неться на сервер

**Тест 2 — видалення вхідного:**
1. Довге натискання на повідомлення співрозмовника
2. "Видалити у себе" — стирається тільки локально

**Тест 3 — видалення чату:**
1. На списку чатів довге натискання на чат
2. "Видалити чат" → стирається

**Тест 4 — scroll-to-bottom:**
1. Скрол вверх по чату на 80+ пікселів
2. Зʼявиться кнопка вниз справа

**Тест 5 — unread badge:**
1. Залиш чат → другий акаунт пише
2. На списку чатів навпроти чата зʼявиться синій badge з числом
3. Відкрий чат → badge зникне

**Тест 6 — online indicator:**
1. Біля заголовка "Чати" має зʼявлятись "підключення" коли WS встановлюється
2. Якщо relay упаде — "офлайн" червоним
3. Коли OK — нічого

**Тест 7 — notifications:**
1. Settings → "Увімкнути сповіщення" → дозволь у браузері
2. Згорни вкладку (інший таб)
3. Другий акаунт пише
4. Має зʼявитися системне сповіщення з текстом
5. Клік по сповіщенню — відкриває чат

## Що далі — План на дні

**День 6:** Групи UI (mini-MVP — створити + членство + чат). Лінки на групу. Налаштування "хто може додавати в групи".
**День 7:** DMS UI.
