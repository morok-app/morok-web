# Morok Web Client — День 3

Federation cross-relay + QR-код + кеш контактів.

## Що нового

**Federation в NewChat:**
- Підтримка повної адреси `@username@relay2.morok.app`
- Локальний пошук → 404? Підказка "спробуйте з @relay"
- Cross-relay lookup через `?relay=hostname`
- Розрізняє 404 (немає юзера) і 503 (relay мертвий)

**QR-код на профілі:**
- Згенерований QR з share-лінком
- Кнопка "Завантажити" → PNG
- Кнопка "Копіювати лінк"

**Кеш контактів:**
- Знайдені юзери зберігаються локально
- На NewChat показується "Нещодавні" — повторний пошук миттєвий
- При logout — кеш чиститься

**Парсер адрес:**
- `addr.js` з валідацією
- Приймає: `vasya`, `@vasya`, `vasya@host`, `@vasya@host`
- Case-insensitive

## Деплой

**На ПК (PowerShell):**
```
cd C:\Users\1\Desktop\morok-web
```

Видаль `node_modules` і `dist` (через провідник або rmdir).

Розпакуй ZIP сюди — замінить файли. Потім:
```
npm install
npm run build
scp -r dist/* root@62.238.28.107:/var/www/morok-web/
```

**На relay1:**
```
ssh root@62.238.28.107
rm /var/www/morok-web/assets/index-*.js
rm /var/www/morok-web/assets/index-*.css
```

Потім **знов** з ПК:
```
scp -r dist/* root@62.238.28.107:/var/www/morok-web/
```

**На relay1:**
```
chmod -R 755 /var/www/morok-web/
```

Відкривай `https://relay1.morok.app/web` з **Ctrl+Shift+R**.

## Як тестувати

**Тест 1 — Federation:**
1. На relay1 (звичайне вікно) — твій акаунт `@satoshi`
2. У incognito — створи акаунт на relay2: натисни шестерню для зміни сервера (це поки нема... TODO?), або просто заплануй коли буде налаштування. Поки роби тест 2.

**Тест 2 — QR:**
1. На профілі побачиш QR
2. Завантаж PNG → відкривається картинка
3. Скопіюй лінк → у incognito-вікні встав в адресу
4. Має одразу відкритись форма з вже введеним юзернеймом

**Тест 3 — Cache:**
1. Знайди юзера через NewChat
2. Вернись назад → на NewChat внизу побачиш "Нещодавні"
3. Натисни на нього → одразу чат відкривається (без relay-запиту)

## Що НЕ зробив (свідомо)

- **Зміна relay в settings** — щоб юзер міг реєструватись не тільки на relay1. День 4 разом з settings UI.
- **Сканер QR** — занадто важко на веб, потрібен мобайл.
- **Federation routing для sendDM** — federation отримує message коли home_relay не наш, але **сервер сам це робить** через outbound queue. Клієнт нічого не міняє.

## Що далі — План

**День 4:** PIN-захист localStorage + Encrypted backup/restore flow + Settings UI (зміна relay).
**День 5+:** Групи UI, DMS, верифікація номерів безпеки.
