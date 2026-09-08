-- 0046 — Administrator-managed contact details and social presence.
-- Empty URLs and disabled switches are deliberate: the public site must never
-- publish placeholder links. Existing settings are preserved on re-run.

insert into public.settings (key, value, value_type, category, label, description)
values
  ('support_phone', '', 'string', 'branding', 'Support phone', 'International format, for example +237 6 00 00 00 00. Leave blank to hide it.'),
  ('support_address', 'Douala, Cameroun', 'string', 'branding', 'Business location', 'Shown in the footer and on the contact page.'),

  ('social_facebook_enabled', 'false', 'boolean', 'social', 'Show Facebook', 'Publishes the Facebook link on the public site.'),
  ('social_facebook_url', '', 'string', 'social', 'Facebook URL', 'A complete https://facebook.com/... address.'),
  ('social_instagram_enabled', 'false', 'boolean', 'social', 'Show Instagram', 'Publishes the Instagram link on the public site.'),
  ('social_instagram_url', '', 'string', 'social', 'Instagram URL', 'A complete https://instagram.com/... address.'),
  ('social_whatsapp_enabled', 'false', 'boolean', 'social', 'Show WhatsApp', 'Publishes the WhatsApp link on the public site.'),
  ('social_whatsapp_url', '', 'string', 'social', 'WhatsApp URL', 'Use https://wa.me/ followed by the international number.'),
  ('social_tiktok_enabled', 'false', 'boolean', 'social', 'Show TikTok', 'Publishes the TikTok link on the public site.'),
  ('social_tiktok_url', '', 'string', 'social', 'TikTok URL', 'A complete https://tiktok.com/@... address.'),
  ('social_youtube_enabled', 'false', 'boolean', 'social', 'Show YouTube', 'Publishes the YouTube link on the public site.'),
  ('social_youtube_url', '', 'string', 'social', 'YouTube URL', 'A complete https://youtube.com/@... address.'),
  ('social_x_enabled', 'false', 'boolean', 'social', 'Show X', 'Publishes the X link on the public site.'),
  ('social_x_url', '', 'string', 'social', 'X URL', 'A complete https://x.com/... address.')
on conflict (key) do nothing;

-- Replace only the shipped legacy defaults. Administrator-entered values are
-- never overwritten.
update public.settings set value = 'Resto237'
where key = 'brand_name' and value = 'RestoLink';

update public.settings set value = 'contact@resto237.online'
where key = 'support_email' and value = 'contact@restolink.cm';

select key, value, category
from public.settings
where category in ('branding', 'social')
order by category, key;
