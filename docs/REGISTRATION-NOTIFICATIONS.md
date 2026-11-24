# Private registration notices

Production Vercel only. Set server-side environment variables REGISTRATION_ADMIN_CHAT_ID (verified positive numeric private Telegram chat ID) and REGISTRATION_ADMIN_USERNAME (expected username without @). Both must match Telegram getChat before a registration notification can be sent; never commit real values. The existing bot token is used. The recipient must first start the bot privately. Send /registrations in that chat to check the total if the webhook is configured. All other chats are ignored for this command.

First completed nickname triggers a single send attempt, not every login. Counts exclude archived merged profiles and unfinished signups. Messages include only total registrations, no individual player information. Delivery is best effort: network failures do not interrupt registration, and the command gives the current total. No automatic retry or guaranteed delivery. Local legacy SQLite backend unchanged.
