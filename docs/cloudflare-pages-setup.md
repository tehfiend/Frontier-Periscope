# Cloudflare Pages Setup -- SSU dApp

## Prerequisites

- Cloudflare account (free tier)
- GitHub repo connected to Cloudflare

## 1. Create Pages Project

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. **Workers & Pages** > **Create** > **Pages** > **Connect to Git**
3. Select the `TehFrontier` repo
4. Configure build settings:

| Setting | Value |
|---------|-------|
| Framework preset | None |
| Build command | `npx turbo run build --filter=@tehfrontier/ssu-dapp` |
| Build output directory | `apps/ssu-dapp/dist` |
| Root directory | `/` (repo root -- needed for pnpm workspace resolution) |

5. Add environment variables:

| Variable | Value |
|----------|-------|
| `NODE_VERSION` | `22` |
| `PNPM_VERSION` | `9.15.4` |

6. Click **Save and Deploy**

You'll get a URL like `https://tehfrontier-ssu.pages.dev` immediately.

## 2. Custom Domain

1. **Pages project** > **Custom domains** > **Set up a custom domain**
2. Enter subdomain, e.g. `ssu.frontierperiscope.com`
3. If domain is on Cloudflare DNS: auto-configured
4. If domain is elsewhere: add a CNAME record:
   ```
   ssu  CNAME  tehfrontier-ssu.pages.dev
   ```

## 3. In-Game SSU URL

Configure the smart assembly's dApp URL to:

```
https://ssu.frontierperiscope.com/?tenant=utopia&itemId={itemId}
```

The game client appends `itemId` and `tenant` automatically.

## SPA Routing & Caching

Already configured via files in `apps/ssu-dapp/public/`:

- `_redirects` -- serves `index.html` for all paths (SPA routing)
- `_headers` -- long-term cache on hashed assets, no-cache on HTML

## Deploying Updates

Push to `main` branch -- Cloudflare auto-builds and deploys.

Preview deployments are created automatically for pull requests.

## Adding More Apps Later

Create additional Pages projects for other apps:

| App | Build command | Output directory |
|-----|--------------|-----------------|
| permissions-dapp | `npx turbo run build --filter=@tehfrontier/permissions-dapp` | `apps/permissions-dapp/dist` |
| ssu-market-dapp | `npx turbo run build --filter=@tehfrontier/ssu-market-dapp` | `apps/ssu-market-dapp/dist` |
| periscope | `npx turbo run build --filter=@tehfrontier/periscope` | `apps/periscope/dist` |

Each gets its own subdomain (e.g. `periscope.frontierperiscope.com`).
