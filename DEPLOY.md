# Morok Web Client — День 2

Реальні 1-on-1 чати з E2E шифруванням і WebSocket real-time.

## Що нового

**Crypto:**
- X25519 key exchange (виводимо з того ж Ed25519 seed)
- XChaCha20-Poly1305 шифрування blob'ів
- Двосторонній E2E test passed

**Екрани:**
- `NewChat` — пошук юзера за @username
- `ChatRoom` — повідомлення + композер + TTL селектор
- `Profile` — share-link, mnemonic backup, logout
- `ChatsList` — реальний список з останнім повідомленням і часом

**WebSocket inbox:**
- Підключається після login
- Catchup pending + real-time `{type:"new"}`
- Auto-reconnect з backoff (1s→2s→5s→10s→30s)
- Pong на ping

**Share links:**
- На профілі: `https://relay1.morok.app/web/#newchat?u=username`
- Хто перейде — одразу відкриється форма щоб написати

## Деплой

**На ПК (PowerShell):**
```
cd C:\Users\1\Desktop\morok-web
```

Розпакуй ZIP сюди — замінить всі файли. **Видаль попередньо `node_modules` і `dist`** (вони будуть створені знову).

```
npm install
npm run build
scp -r dist/* root@62.238.28.107:/var/www/morok-web/
```

На relay1 як root:
```
chmod -R 755 /var/www/morok-web/
```

**Готово.** Перевантажуй `https://relay1.morok.app/web` у браузері (Ctrl+Shift+R щоб без кешу).

## Як тестувати

1. **Створи другий акаунт** в incognito-вікні. Запам'ятай юзернейм.
2. У першому вікні (твій основний): натисни `+` → введи юзернейм другого → знайти
3. Напиши повідомлення → надіслати
4. Перевір incognito-вікно: має з'явитись чат і повідомлення в межах ~2 секунд

**Очікувано:**
- ✓ зеленим у тебе після успішної відправки
- TTL індикатор показує час життя
- При перезавантаженні сторінки чат залишається (localStorage)
- Через TTL хвилин повідомлення зникне з обох сторін

## Що НЕ зробив (свідомо)

- **Federation routing.** Зараз lookup йде тільки по локальному relay'ю. Якщо юзер на relay2 — не знайдеш. Виправлю у Дні 3 разом з cross-relay UX.
- **Burn-on-read.** Ми погодились робити TTL only. Burn-on-read окрема фіча на потім.
- **PIN для localStorage.** День 4.
- **Групи UI.** День 5+.

## Що далі — План

**День 3:** Federation lookup (cross-relay), QR-код на профілі, контакти.
**День 4:** PIN-шифрування seed у localStorage + backup/restore flow.
**День 5+:** Групи UI, DMS, settings.
