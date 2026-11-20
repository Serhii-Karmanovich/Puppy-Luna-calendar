# Синхронізація щоденника Луни

1. Створіть безкоштовний проєкт на [supabase.com](https://supabase.com).
2. У Supabase відкрийте **SQL Editor** і виконайте весь файл `supabase/schema.sql`.
3. У **Project Settings → API** скопіюйте `Project URL` і публічний `anon key` у `dist/supabase-config.js`.
4. Опублікуйте зміни на GitHub Pages.

Користувачі входять через email і пароль. Перший користувач створює сім’ю Луни, а інші приєднуються за кодом запрошення. Дані зберігаються в `luna_state` і транслюються через Supabase Realtime.

Ніколи не додавайте в браузерний файл `service_role key`.
