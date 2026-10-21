# SETUP — what you type, and where it goes

Secret values are typed only into gh's own prompt, on your computer:

    gh secret set NAME --repo jovo-jovi/tinytasks

The DEV_OS engine never sees the value, and no model ever does. The configuration
model does not get an Actions secret: it runs once, at init, on your computer.

`scripts/devos/setup.mjs` reads the bullets below. Each bullet is a name only.

## Agent secrets

The GitHub reviewer and the GitHub builder are both Cursor, so one key covers both.

- CURSOR_API_KEY

Where to get it: Cursor dashboard → https://cursor.com/dashboard → API keys → Create key.

## Module secrets

Hosting is on, provider Vercel.

- VERCEL_TOKEN
- VERCEL_ORG_ID
- VERCEL_PROJECT_ID

Where to get them:

- VERCEL_TOKEN: Vercel → https://vercel.com/account/settings/tokens → Create token (scope it to the team).
- VERCEL_ORG_ID: Vercel → your team Settings → General → Vercel ID.
- VERCEL_PROJECT_ID: Vercel → the project Settings → General → Project ID. Create the Vercel project linked to this repository first, then copy the id.

Styling (Tailwind), ui-kit (shadcn), i18n (en, ar), testing (unit only), and automation have no secret names.

## After typing secrets

Run `devos keys --check` from this folder. It compares GitHub's secret list with the names above.

Re-run the devos-cycle workflow from the Actions tab, or push any commit to main.
The setup issue closes itself when every required name is set.

If a name is still missing after init, type it with the command at the top, then run `devos keys --check`. Do not paste a value into chat, an issue, or a commit.
