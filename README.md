# Printpick: client photo selection for photographers (monthly subscriptions)

Photographers sign up, get a free trial, then pay a monthly subscription through Stripe. Each photographer has a private dashboard and private client galleries. You are the platform owner.

## How it works
- `/` landing page with pricing and sign up / log in.
- `/admin` each photographer's dashboard: create galleries, upload photos, copy the client link, see picks, download originals.
- `/g/<code>` the private client gallery.
- A photographer whose trial ended or subscription was cancelled cannot upload or create galleries, and their clients see "gallery not available". They can still log in and download their originals.
- Your own account (OWNER_EMAIL) is free and never expires.
- Each photographer gets STORAGE_LIMIT_GB of space (default 20 GB).

## Set up Stripe (do this first)
1. Make an account at stripe.com.
2. Products > Add product > recurring monthly price. Copy the Price ID (starts with price_).
3. Developers > API keys: copy the Secret key (starts with sk_).
4. After the site is online: Developers > Webhooks > Add endpoint:
   URL = https://YOUR-SITE/stripe/webhook, events = checkout.session.completed, customer.subscription.updated, customer.subscription.deleted. Copy the Signing secret (starts with whsec_).
5. Settings > Billing > Customer portal: turn it on so photographers can update their card or cancel.
Use Stripe test mode first (test keys, card 4242 4242 4242 4242).

## Put it online (Render)
1. Upload this folder to a private GitHub repository.
2. render.com > New > Blueprint > pick the repository.
3. Fill in the values it asks for (OWNER_EMAIL, BASE_URL and the three Stripe values; add the webhook secret after step 4 above).
4. Change PRICE_LABEL in render.yaml so the website shows the same price as your Stripe price.

Render cost: Starter web service about $7/month plus disk storage about $0.25/GB/month (check render.com/pricing). Make sure total photographer storage fits the disk size in render.yaml (100 GB there). Increase sizeGB as you add photographers.

## Not included yet
- Password reset by email (a photographer who forgets their password needs you to help; there is no email sending).
- Terms of service and privacy policy pages. You need these before charging people, and photographers' clients' photos are personal data.
- Separate plan tiers, custom domains per photographer, admin screen to see all photographers.
- Taxes: Stripe Tax can be turned on in your Stripe account.

## Notes
- `npm install` installs `sharp` for watermarked previews. Without it, previews are NOT resized or watermarked.
- Screenshots cannot be fully blocked on any website. Watermarked small previews are the real protection.
- Back up the data disk regularly.
