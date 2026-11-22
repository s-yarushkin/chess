# Chess Academy — Vercel + Neon (закрытый пилот)

## Схема

- `public/` — статическое приложение. `api/index.js` — Vercel Function (Node.js).
- PostgreSQL Neon — постоянное хранение игроков, сессий, попыток и завершений.
- `data/school-v1/*.jsonl` — локально упакованный в Function каталог 3000 проверенных Lichess CC0 задач (не загружается в базу).
- Telegram `initData` проверяется сервером. Вход только по списку Telegram ID приглашённых **взрослых**; без списка вход закрыт.
- Открытый рейтинг и друзья выключены для первого пилота. Никакой самостоятельной регистрации детей.

## Подготовка проекта Vercel

1. Подключить репозиторий `s-yarushkin/chess` к Vercel проекту `chess-academy`.
2. Neon → Connect to Project → Production. Интеграция обычно добавляет `DATABASE_URL` (pooled) автоматически. Не копировать секрет в GitHub или чат.
3. Vercel Environment Variables (Production):
   - `TG_BOT_TOKEN` — токен BotFather, **Sensitive**.
   - `PILOT_TELEGRAM_IDS` — числовые Telegram user ID **взрослых тестировщиков**, через запятую. Не содержит имён и фамилий.
   - `TG_WEBHOOK_SECRET` — случайная строка 32–64 символа из `[A-Za-z0-9_-]`, **Sensitive**.
   - `WEBAPP_URL` — HTTPS production URL проекта (получить после первого deploy), например `https://chess-academy.vercel.app`.
   - `NODE_ENV=production`, `DEV_MODE=0`.
4. Убедиться, что в Vercel Build Settings `Framework Preset: Other`, Root Directory `.`, Output Directory — default. `vercel.json` описывает Function и маршруты.
5. Дождаться сборки GitHub → Vercel и проверить `GET https://.../healthz`: `status=ok`, `database=connected`, 900+1100+1000 задач.
6. Секреты Production действуют только для **нового** deployment после их добавления. Выполнить Redeploy, если менялись после сборки.
7. В доверенной терминальной сессии с переменными окружения запустить `npm run bot:setup`. Команда проверит бота и настроит webhook / кнопку запуска; токен не выводится.
8. Написать своему боту `/start` с добавленного в allowlist взрослого Telegram и открыть приложение через кнопку. Проверить вход, имя, решение, повторный вход и сохранение очков.

## Защита

- Нет локального `DEV_MODE` на Vercel.
- `/api/auth/dev` отвечает 404. Используется Telegram HMAC + свежий `auth_date`.
- `PILOT_TELEGRAM_IDS` является fail-closed: если пусто, вход запрещён.
- Нет публичной ленты детей/поиска/сообщений. Родительский вход нужно реализовать отдельно перед пилотом со школьниками.
- SQL-параметры передаются отдельно, завершения уникальны по `(user_id, puzzle_id)`.
- `/healthz` публично возвращает только состояние и размеры каталога, никаких секретов.

## Если проблема

- `Server error`/`503` на `/healthz` — проверить наличие `DATABASE_URL` в **Production** и логи Function.
- `503` с отсутствующим каталогом — проверить `functions.includeFiles` и Vercel output.
- `Unauthorized` — открывать через Telegram Mini App, а не обычную вкладку; проверить `PILOT_TELEGRAM_IDS`.
- Ошибка webhook — проверить `WEBAPP_URL`, `TG_WEBHOOK_SECRET`, `getWebhookInfo` в безопасной сессии.
- Если Vercel Authentication защищает production `*.vercel.app`, проверять Deployment Protection: бот не может открыть страницу, требующую интерактивного входа Vercel. Менять protection только после проверки собственной авторизации и пилотного списка.

## Отладка и миграция

Старый Node/SQLite backend остаётся для локальных тестов, он **не используется Vercel Function**. Скрипты `npm test` проверяют старую базовую шахматную логику; для Neon проведите реальный smoke-тест на тестовой PostgreSQL. Данные старого SQLite автоматически **не** переносятся. В пилоте Neon начинается с пустых пользователей.

## Самый быстрый старт без webhook

Для первого взрослого теста `TG_WEBHOOK_SECRET` и `WEBAPP_URL` **не обязательны**. Telegram Mini App запускается напрямую через меню бота.

1. В `@BotFather` выполните `/setmenubutton`, выберите нужного бота, задайте адрес `https://chess-academy-theta.vercel.app` и текст «Играть в шахматы».
2. Откройте меню бота в Telegram. Проверка подписанного `initData` должна отклонить аккаунт, ещё не внесённый в список. В сообщении появится **ваш собственный** цифровой Telegram ID.
3. В Vercel → `chess-academy` → Settings → Environment Variables добавьте `PILOT_TELEGRAM_IDS` (Production), указав этот ID или несколько ID **взрослых тестировщиков** через запятую.
4. Выполните новый Production deployment / Redeploy. После этого откройте меню бота ещё раз и решите одну задачу; затем выйдите и зайдите для проверки сохранения.

Меню бота не требует webhook; webhook понадобится позже для команд `/start` и ответных сообщений от бота. Не размещайте токены в чатах или GitHub.
